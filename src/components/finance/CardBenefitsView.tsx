import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { SupabaseClient } from "@supabase/supabase-js";
import {
  Sparkles, CheckCircle, RotateCcw, Loader2, RefreshCw, CreditCard,
  ChevronDown, ChevronRight, Zap, TrendingUp, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import { toast } from "sonner";
import {
  type RawBenefit, type CardBenefits, dedupeBenefits, summarizeBenefits, isActionable,
  buildSpendSuggestions, reconcileFetched, cleanText,
} from "@/lib/card-benefits";

interface Props {
  accounts: { account_id: string; name: string; official_name?: string | null; type: string }[];
  supabase: SupabaseClient;
  user: { id: string } | null;
  txns?: { account_id: string; amount: number; date: string; category: string[] | null }[];
}

// Cards whose lookup came back empty (store cards, unknown products) are
// remembered for a week so every visit doesn't re-run the slow AI lookup —
// that re-fetch on every load was the main cause of the ~30s spinner.
const EMPTY_LOOKUP_TTL_MS = 7 * 86400000;
const lookupCacheKey = (userId: string) => `sentryfi_benefits_lookup:${userId}`;
const readLookupCache = (userId: string): Record<string, number> => {
  try { return JSON.parse(localStorage.getItem(lookupCacheKey(userId)) ?? "{}") ?? {}; } catch { return {}; }
};
const writeLookupCache = (userId: string, ids: string[]) => {
  try {
    const cache = readLookupCache(userId);
    const now = Date.now();
    for (const id of ids) cache[id] = now;
    localStorage.setItem(lookupCacheKey(userId), JSON.stringify(cache));
  } catch { /* storage full / disabled — just refetch next time */ }
};

const rowToRaw = (b: Record<string, unknown>): RawBenefit => ({
  key: String(b.benefit_key),
  title: b.title as string | null, description: b.description as string | null,
  value: b.value as string | null, period: b.period as string | null,
  action_type: b.action_type as string | null, action_label: b.action_label as string | null,
  cashback_category: b.cashback_category as string | null, cashback_rate: b.cashback_rate as number | null,
  priority: (b.priority as number | null) ?? 5, used_at: (b.used_at as string | null) ?? null,
});

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
  // Raw rows per account as stored in card_benefits; everything rendered is
  // derived from this via dedupe so there is one source for lists and counts.
  const [rawByCard, setRawByCard] = useState<Record<string, RawBenefit[]>>({});
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<string> | null>(null);
  const [activeTab, setActiveTab] = useState<"actions" | "optimize" | "all">("actions");
  const inFlight = useRef(false);

  const creditCards = useMemo(() => accounts.filter(a => a.type === "credit"), [accounts]);
  const creditKey = creditCards.map(c => c.account_id).join(",");

  const cards: CardBenefits[] = useMemo(() => creditCards.map(c => ({
    account_id: c.account_id,
    name: cleanText(c.name) || "Credit card",
    official_name: cleanText(c.official_name) || cleanText(c.name) || "Credit card",
    benefits: dedupeBenefits(rawByCard[c.account_id] ?? []),
  })), [creditCards, rawByCard]);

  const summary = useMemo(() => summarizeBenefits(cards), [cards]);
  const spendOpt = useMemo(() => buildSpendSuggestions(cards, txns, accounts), [cards, txns, accounts]);

  /** AI lookup for the given cards; merges results into card_benefits without duplicating existing perks. */
  const fetchFromAI = useCallback(async (targets: typeof creditCards, existing: Record<string, RawBenefit[]>) => {
    if (!user || !targets.length) return;
    setFetching(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-card-benefits", {
        body: { cards: targets.map(c => ({ account_id: c.account_id, name: c.name, official_name: c.official_name ?? c.name })) },
      });
      if (error || data?.error) {
        toast.error("Could not fetch benefits", { description: cleanText(data?.error) || cleanText(error?.message) || "Please try again." });
        return;
      }
      const fetched: Record<string, RawBenefit[]> = data?.benefits ?? {};
      const failed = new Set<string>(Array.isArray(data?.failed) ? data.failed : []);
      const fetchedAt = new Date().toISOString();
      const upserts: Record<string, unknown>[] = [];
      const deletions: { accountId: string; keys: string[] }[] = [];
      const next: Record<string, RawBenefit[]> = {};

      for (const c of targets) {
        if (failed.has(c.account_id)) continue;
        const incoming = Array.isArray(fetched[c.account_id]) ? fetched[c.account_id] : [];
        const prior = existing[c.account_id] ?? [];
        const { rows, redundantKeys } = reconcileFetched(prior, incoming);
        if (redundantKeys.length) deletions.push({ accountId: c.account_id, keys: redundantKeys });
        for (const b of rows) {
          upserts.push({
            user_id: user.id, account_id: c.account_id, benefit_key: b.key,
            title: cleanText(b.title), description: cleanText(b.description),
            value: cleanText(b.value) || null, period: cleanText(b.period) || null,
            action_type: cleanText(b.action_type) || null, action_label: cleanText(b.action_label) || null,
            cashback_category: cleanText(b.cashback_category) || null,
            cashback_rate: b.cashback_rate ?? null, priority: b.priority ?? 5, fetched_at: fetchedAt,
          });
        }
        const keep = prior.filter(p => !redundantKeys.includes(p.key) && !rows.some(r => r.key === p.key));
        next[c.account_id] = [...keep, ...rows.map(r => ({ ...r, used_at: prior.find(p => p.key === r.key)?.used_at ?? null }))];
      }

      // One batched write instead of one awaited round-trip per perk.
      const writes: PromiseLike<unknown>[] = [];
      if (upserts.length) {
        writes.push(supabase.from("card_benefits").upsert(upserts, { onConflict: "user_id,account_id,benefit_key" })
          .then(({ error: e }) => { if (e) console.warn("[card_benefits] upsert failed:", e.message); }));
      }
      for (const d of deletions) {
        writes.push(supabase.from("card_benefits").delete()
          .eq("user_id", user.id).eq("account_id", d.accountId).in("benefit_key", d.keys)
          .then(({ error: e }) => { if (e) console.warn("[card_benefits] dedupe delete failed:", e.message); }));
      }
      await Promise.all(writes);

      writeLookupCache(user.id, targets.filter(c => !failed.has(c.account_id)).map(c => c.account_id));
      setRawByCard(prev => ({ ...prev, ...next }));
      if (failed.size) toast.error(`Couldn't look up ${failed.size} card${failed.size !== 1 ? "s" : ""}`, { description: "Try Refresh again in a bit." });
    } catch (e) {
      toast.error("Could not fetch benefits", { description: e instanceof Error ? e.message : "Please try again." });
    } finally {
      setFetching(false);
    }
  }, [supabase, user]);

  const loadBenefits = useCallback(async (refresh = false) => {
    if (!user || !creditCards.length || inFlight.current) { if (!user || !creditCards.length) setInitialLoaded(true); return; }
    inFlight.current = true;
    setLoadError(null);
    try {
      // 1. Stored perks first — rendered immediately (progressive load).
      const { data: existing, error } = await supabase
        .from("card_benefits")
        .select("*")
        .eq("user_id", user.id)
        .order("priority", { ascending: true });
      if (error) throw new Error(error.message);
      const byCard: Record<string, RawBenefit[]> = {};
      for (const b of existing ?? []) (byCard[b.account_id] ??= []).push(rowToRaw(b));
      setRawByCard(byCard);
      setInitialLoaded(true);

      // 2. AI lookup only for cards that have nothing stored and weren't
      //    looked up recently (or every card on an explicit Refresh).
      const cache = readLookupCache(user.id);
      const targets = refresh ? creditCards : creditCards.filter(c =>
        !byCard[c.account_id]?.length && !(cache[c.account_id] && Date.now() - cache[c.account_id] < EMPTY_LOOKUP_TTL_MS));
      await fetchFromAI(targets, byCard);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setInitialLoaded(true);
    } finally {
      inFlight.current = false;
    }
  }, [user, creditCards, supabase, fetchFromAI]);

  // Re-run when the set of credit cards changes (accounts often arrive after
  // the first render; the old effect only depended on user id and never retried).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadBenefits(); }, [user?.id, creditKey]);

  const keysFor = (accountId: string, key: string) =>
    cards.find(c => c.account_id === accountId)?.benefits.find(b => b.key === key)?.keys ?? [key];

  const setUsed = async (accountId: string, key: string, usedAt: string | null) => {
    if (!user) return;
    const keys = keysFor(accountId, key);
    setRawByCard(prev => ({
      ...prev,
      [accountId]: (prev[accountId] ?? []).map(b => keys.includes(b.key) ? { ...b, used_at: usedAt } : b),
    }));
    const { error } = await supabase.from("card_benefits")
      .update({ used_at: usedAt })
      .eq("user_id", user.id).eq("account_id", accountId).in("benefit_key", keys);
    if (error) toast.error("Couldn't save", { description: error.message });
    else if (usedAt) toast.success("Marked as done");
  };
  const markUsed = (accountId: string, key: string) => setUsed(accountId, key, new Date().toISOString());
  const restore = (accountId: string, key: string) => setUsed(accountId, key, null);

  const loading = fetching || !initialLoaded;

  // All actionable benefits across all cards, sorted by priority
  const allActions = cards.flatMap(c =>
    c.benefits
      .filter(b => !b.used_at && isActionable(b))
      .map(b => ({ ...b, card_name: c.official_name || c.name, account_id: c.account_id }))
  ).sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5));

  const doneActions = cards.flatMap(c =>
    c.benefits.filter(b => !!b.used_at).map(b => ({ ...b, card_name: c.official_name || c.name, account_id: c.account_id }))
  );

  const isExpanded = (id: string) => expandedCards ? expandedCards.has(id) : (summary.perCard[id]?.total ?? 0) > 0;
  const toggleExpanded = (id: string) => setExpandedCards(prev => {
    const n = new Set(prev ?? cards.filter(c => c.benefits.length > 0).map(c => c.account_id));
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const cardsWithoutPerks = cards.filter(c => c.benefits.length === 0);

  const tabs = [
    { k: "actions" as const, label: `Take action${summary.pendingActions > 0 ? ` (${summary.pendingActions})` : ""}` },
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

      {fetching && summary.totalPerks > 0 && (
        <div className="flex items-center gap-2 px-1 text-[12px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Looking up perks for your other cards…
        </div>
      )}

      {loadError ? (
        <div className="surface-card p-10 text-center">
          <AlertCircle className="h-8 w-8 text-negative/60 mx-auto mb-2" />
          <div className="text-[13px] font-medium text-foreground">Couldn't load your card benefits</div>
          <div className="text-[11.5px] text-muted-foreground mt-1">{loadError}</div>
          <button onClick={() => loadBenefits()} className="mt-3 h-8 px-4 rounded-full bg-foreground text-background text-[12px] font-medium">
            Try again
          </button>
        </div>
      ) : loading && summary.totalPerks === 0 && creditCards.length > 0 ? (
        <div className="surface-card p-12 flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-8 w-8 text-[hsl(var(--primary))] animate-spin" />
          <div className="text-[13px] text-muted-foreground">{initialLoaded ? "Analyzing your cards…" : "Loading your card benefits…"}</div>
        </div>
      ) : (

        /* ── TAKE ACTION tab ── */
        activeTab === "actions" ? (
          <div className="space-y-2">
            {allActions.length === 0 && !loading ? (
              creditCards.length === 0 ? (
                <div className="surface-card p-10 text-center">
                  <CreditCard className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                  <div className="text-[13px] font-medium text-foreground">No credit cards connected</div>
                  <div className="text-[11.5px] text-muted-foreground mt-1">Connect a credit card to see personalized perks and actions here.</div>
                </div>
              ) : (
                <div className="surface-card p-10 text-center">
                  <CheckCircle className="h-8 w-8 text-positive mx-auto mb-2 opacity-60" />
                  <div className="text-[13px] font-medium text-foreground">All done!</div>
                  <div className="text-[11.5px] text-muted-foreground mt-1">No pending actions. Check "All perks" to see everything.</div>
                </div>
              )
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
                        {b.value && (
                          <span className={cn("text-[10.5px] font-bold px-2 py-0.5 rounded-full border shrink-0", color)}>
                            {b.value}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{b.card_name}</div>
                      {b.description && <div className="text-[12.5px] text-foreground/80 mt-1.5 leading-relaxed">{b.description}</div>}
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
                  <span className="text-[12px] text-muted-foreground">{summary.completed} completed</span>
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
                <div className="text-[13px] font-medium text-foreground">{txns.length ? "You're already using your best cards" : "No recent spending to analyze"}</div>
                <div className="text-[11.5px] text-muted-foreground mt-1">Compares your cards' reward rates against the last 90 days of spending</div>
                <button onClick={() => loadBenefits(true)} disabled={loading}
                  className="mt-3 h-8 px-4 rounded-full bg-foreground text-background text-[12px] font-medium">
                  Analyze now
                </button>
              </div>
            ) : (
              <>
                <div className="px-1 text-[12px] text-muted-foreground">
                  Based on your last 90 days of spending · miles/points valued at ~1¢
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
                          <div className="text-[13px] font-bold text-positive tabular">+{fmtUSD(gain)}/yr</div>
                          <div className="text-[10.5px] text-muted-foreground">potential savings</div>
                        </div>
                      </div>

                      {/* Current vs better */}
                      <div className="flex items-center gap-2">
                        {/* Current */}
                        <div className="flex-1 rounded-xl bg-muted/30 p-2.5">
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Currently using</div>
                          <div className="text-[12px] font-semibold text-foreground truncate">
                            {s.current_card_name}
                          </div>
                          <div className="text-[12px] text-muted-foreground">
                            {s.current_rate_label}
                          </div>
                        </div>

                        <ChevronRight className="h-4 w-4 text-positive shrink-0" />

                        {/* Better */}
                        <div className="flex-1 rounded-xl bg-positive/8 border border-positive/20 p-2.5">
                          <div className="text-[10px] text-positive uppercase tracking-wide mb-1 font-semibold">Switch to</div>
                          <div className="text-[12px] font-semibold text-foreground truncate">{s.best_card_name}</div>
                          <div className="text-[12px] text-positive font-semibold">{s.best_rate_label}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>

        /* ── ALL PERKS tab ── */
        ) : summary.totalPerks === 0 ? (
          <div className="surface-card p-10 text-center">
            <CreditCard className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
            <div className="text-[13px] font-medium text-foreground">No perks found yet</div>
            <div className="text-[11.5px] text-muted-foreground mt-1">
              {cards.length === 0 ? "Link a credit card to see its benefits here." : "Hit refresh to look up benefits for your cards."}
            </div>
            {cards.length > 0 && (
              <button onClick={() => loadBenefits(true)} disabled={loading}
                className="mt-3 h-8 px-4 rounded-full bg-foreground text-background text-[12px] font-medium">
                Refresh
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="px-1 text-[12px] text-muted-foreground">
              {summary.totalPerks} perks · {summary.completed} completed
            </div>
            {cards.filter(c => c.benefits.length > 0).map(card => {
              const expanded = isExpanded(card.account_id);
              const counts = summary.perCard[card.account_id];
              return (
                <div key={card.account_id} className="surface-card overflow-hidden">
                  <button onClick={() => toggleExpanded(card.account_id)} className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-muted/20">
                    <CreditCard className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-semibold text-foreground truncate">
                        {card.official_name || card.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {counts.total} perks · {counts.completed} completed
                      </div>
                    </div>
                    <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground/40 transition-transform", expanded && "rotate-180")} />
                  </button>
                  {expanded && (
                    <div className="border-t border-border/20 divide-y divide-border/10">
                      {card.benefits.map(b => (
                        <div key={b.key} className={cn("flex items-start gap-3 px-5 py-3.5", b.used_at && "opacity-50")}>
                          <div className="mt-0.5 text-[14px]">{ACTION_ICON[b.action_type ?? "none"]}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={cn("text-[13px] font-medium", b.used_at ? "text-muted-foreground line-through" : "text-foreground")}>
                                {b.title}
                              </span>
                              {b.value && (
                                <span className="text-[10px] text-muted-foreground">· {b.value}</span>
                              )}
                            </div>
                            {b.description && <div className="text-[11.5px] text-muted-foreground mt-0.5 leading-relaxed">{b.description}</div>}
                          </div>
                          {b.used_at ? (
                            <button onClick={() => restore(card.account_id, b.key)}
                              className="h-6 px-2 rounded-full border border-border/40 text-[10px] text-muted-foreground shrink-0">
                              Undo
                            </button>
                          ) : isActionable(b) ? (
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
            {cardsWithoutPerks.length > 0 && !fetching && (
              <div className="surface-card px-5 py-3.5 text-[11.5px] text-muted-foreground">
                No notable perks found for {cardsWithoutPerks.map(c => c.official_name || c.name).join(", ")}. Store and basic cash-back cards often have none; tap Refresh to look them up again.
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
};
