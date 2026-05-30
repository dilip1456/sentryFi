import { useState, useMemo } from "react";
import {
  cardOffers, bestCardByCategory, type CardOffer,
} from "@/lib/finance-data";
import { fmtUSD } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  ShoppingBag, Plane, X, Check, Search, Zap, Sparkles, ArrowRight,
  CheckCheck, Tag,
} from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";
import { Switch } from "@/components/ui/switch";

const sourceColor: Record<CardOffer["source"], string> = {
  "Amex Offers":    "bg-info/10 text-info border-info/20",
  "Chase Offers":   "bg-[hsl(220_70%_60%)]/10 text-[hsl(220_70%_75%)] border-[hsl(220_70%_60%)]/20",
  "Citi Merchant":  "bg-[hsl(280_70%_65%)]/10 text-[hsl(280_70%_75%)] border-[hsl(280_70%_65%)]/20",
  "Apple Card":     "bg-foreground/10 text-foreground border-border-strong",
};

/* ----------------------- Offer row ----------------------- */
const OfferRow = ({ o, onToggle, onClick }: { o: CardOffer; onToggle: () => void; onClick: () => void }) => {
  const Icon = o.icon;
  return (
    <div className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-hover/40 transition-colors">
      <button onClick={onClick} className="flex items-center gap-3 flex-1 min-w-0 text-left">
        <div className="h-9 w-9 rounded-md bg-secondary/60 border border-border/60 grid place-items-center text-foreground/80">
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-foreground truncate font-medium">{o.merchant}</span>
            <span className={cn("text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border", sourceColor[o.source])}>
              {o.source}
            </span>
          </div>
          <div className="text-[10.5px] text-muted-foreground mt-0.5 truncate">
            {o.cardName} · spend ≥ {fmtUSD(o.minSpend)} · expires {o.expires}
          </div>
        </div>
        <div className="text-right shrink-0 hidden sm:block">
          <div className="text-[12px] tabular text-positive font-medium">{o.reward}</div>
          <div className="text-[10px] text-muted-foreground tabular">~{fmtUSD(o.rewardValue)} value</div>
        </div>
      </button>
      <Switch checked={o.optedIn} onCheckedChange={onToggle} />
    </div>
  );
};

const OfferDetail = ({ o, onClose }: { o: CardOffer | null; onClose: () => void }) => {
  if (!o) return null;
  const Icon = o.icon;
  return (
    <Dialog open={!!o} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm surface-elevated p-0 gap-0 overflow-hidden">
        <div className="p-6 relative">
          <button onClick={onClose} className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover">
            <X className="h-4 w-4" />
          </button>
          <div className="h-11 w-11 rounded-xl bg-secondary/60 border border-border-strong grid place-items-center">
            <Icon className="h-5 w-5 text-foreground" />
          </div>
          <div className="mt-3 text-[10px] uppercase tracking-wider text-muted-foreground">{o.category} · via {o.source}</div>
          <div className="font-display text-xl text-foreground mt-0.5">{o.merchant}</div>
          <div className="mt-3 inline-flex items-baseline gap-2 rounded-md bg-positive/10 border border-positive/20 px-2.5 py-1.5">
            <span className="font-display text-base tabular text-positive">{o.reward}</span>
            <span className="text-[10px] text-muted-foreground">≈ {fmtUSD(o.rewardValue)} back</span>
          </div>
        </div>
        <div className="hairline px-6 py-4 space-y-2 text-[12px]">
          <Row label="Card to use"      value={o.cardName} />
          <Row label="Min. spend"       value={fmtUSD(o.minSpend)} />
          <Row label="Expires"          value={o.expires} />
          <Row label="Reward type"      value={o.kind === "cashback" ? "Statement cashback" : o.kind === "points" ? "Bonus points" : "Statement credit"} />
        </div>
        <div className="hairline p-4 flex gap-2">
          <button className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-foreground text-background px-3 py-2 text-xs font-medium">
            <Check className="h-3.5 w-3.5" /> {o.optedIn ? "Opted in" : "Opt in now"}
          </button>
          <button className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-strong px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
            Shop <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between items-center">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-foreground tabular">{value}</span>
  </div>
);

/* ----------------------- Best card finder ----------------------- */
const BestCardFinder = () => {
  const [query, setQuery] = useState("");
  const [pickedCategory, setPickedCategory] = useState<string | null>(null);

  const matches = useMemo(() => {
    if (!query) return [] as { merchant: string; offer: CardOffer }[];
    const q = query.toLowerCase();
    return cardOffers
      .filter((o) => o.merchant.toLowerCase().includes(q))
      .map((o) => ({ merchant: o.merchant, offer: o }));
  }, [query]);

  const recommendation = pickedCategory ? bestCardByCategory[pickedCategory] : null;

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search merchant — e.g. Marriott, Best Buy, Spotify..."
          className="w-full bg-surface/60 border border-border rounded-lg pl-9 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-border-strong"
        />
      </div>

      {query && matches.length > 0 && (
        <div className="surface-card overflow-hidden">
          <div className="px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border/40">
            Best card for "{query}"
          </div>
          {matches.slice(0, 4).map(({ offer }) => {
            const Icon = offer.icon;
            return (
              <div key={offer.id} className="flex items-center gap-3 px-4 py-3 hairline border-t-0">
                <Icon className="h-4 w-4 text-foreground/70" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-foreground">{offer.merchant}</div>
                  <div className="text-[10.5px] text-muted-foreground">Use <b className="text-foreground">{offer.cardName}</b> · {offer.reward}</div>
                </div>
                <div className="text-[12px] tabular text-positive">~{fmtUSD(offer.rewardValue)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Category quick picks */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Or pick a category</div>
        <div className="flex flex-wrap gap-1.5">
          {Object.keys(bestCardByCategory).map((cat) => (
            <button
              key={cat}
              onClick={() => setPickedCategory(cat === pickedCategory ? null : cat)}
              className={cn(
                "px-3 py-1.5 rounded-full text-[11px] border transition-colors",
                pickedCategory === cat
                  ? "bg-foreground text-background border-foreground"
                  : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border-strong",
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {recommendation && (
        <div className="surface-card p-4 border-positive/30 bg-positive/5">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-lg bg-positive/15 border border-positive/30 grid place-items-center text-positive">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Best for {pickedCategory}</div>
              <div className="font-display text-lg text-foreground">{recommendation.cardName}</div>
              <div className="text-[12px] text-positive tabular mt-0.5">{recommendation.rate}</div>
              <div className="text-[11px] text-muted-foreground mt-1">{recommendation.note}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ----------------------- Main section ----------------------- */
export const DealsSection = () => {
  const [offers, setOffers] = useState(cardOffers);
  const [selected, setSelected] = useState<CardOffer | null>(null);
  const [tab, setTab] = useState<"all" | "Travel" | "Dining" | "Shopping" | "Streaming">("all");

  const visible = useMemo(() =>
    tab === "all" ? offers : offers.filter((o) => o.category === tab),
  [offers, tab]);

  const totalPotential = offers.reduce((s, o) => s + o.rewardValue, 0);
  const totalActive    = offers.filter((o) => o.optedIn).reduce((s, o) => s + o.rewardValue, 0);
  const optInPct       = offers.length > 0 ? (offers.filter((o) => o.optedIn).length / offers.length) * 100 : 0;

  const toggle = (id: string) => setOffers((p) => p.map((o) => o.id === id ? { ...o, optedIn: !o.optedIn } : o));
  const optInAll = () => setOffers((p) => p.map((o) => ({ ...o, optedIn: true })));

  // Group by source
  const bySource = visible.reduce<Record<string, CardOffer[]>>((acc, o) => {
    (acc[o.source] ??= []).push(o);
    return acc;
  }, {});

  return (
    <div className="space-y-4 animate-fade-up">
      {/* Compact summary strip */}
      <div className="surface-card px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-5 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-positive/10 border border-positive/20 text-positive grid place-items-center">
              <Tag className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">Total potential</div>
              <div className="font-display text-base tabular text-foreground leading-tight mt-0.5">{fmtUSD(totalPotential, { compact: true })}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-info/10 border border-info/20 text-info grid place-items-center">
              <CheckCheck className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">Active</div>
              <div className="font-display text-base tabular text-foreground leading-tight mt-0.5">
                {fmtUSD(totalActive, { compact: true })} <span className="text-[10.5px] text-muted-foreground">· {optInPct.toFixed(0)}%</span>
              </div>
            </div>
          </div>
        </div>
        <button
          onClick={optInAll}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-foreground text-background text-[12px] font-medium hover:opacity-90"
        >
          <Zap className="h-3.5 w-3.5" /> Auto opt-in all
        </button>
      </div>

      {/* Best card finder */}
      <CollapsibleSection
        title="Best card for any purchase"
        subtitle="Search a merchant or pick a category to see the optimal card."
      >
        <BestCardFinder />
      </CollapsibleSection>

      {/* All offers */}
      <CollapsibleSection
        title="Active card offers"
        subtitle="Aggregated from every linked card. Toggle to opt in."
        trailing={
          <div className="hidden md:inline-flex text-[11px] text-positive tabular">
            +{fmtUSD(totalPotential - totalActive, { compact: true })} unclaimed
          </div>
        }
      >
        {/* Category tabs */}
        <div className="flex flex-wrap items-center gap-1 mb-3">
          {(["all", "Travel", "Dining", "Shopping", "Streaming"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-3 py-1 rounded-full text-[11px] capitalize transition-colors",
                tab === t ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground border border-border/60",
              )}
            >
              {t}
            </button>
          ))}
          <span className="ml-2 text-[11px] text-muted-foreground">{visible.length} offer{visible.length !== 1 ? "s" : ""}</span>
        </div>

        <div className="space-y-3">
          {Object.entries(bySource).map(([source, list]) => (
            <div key={source} className="surface-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 bg-surface/60">
                <div className={cn("text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border", sourceColor[source as CardOffer["source"]])}>
                  {source}
                </div>
                <span className="text-[10.5px] text-muted-foreground tabular">{list.length} active</span>
              </div>
              <div className="divide-y divide-border/30 p-1">
                {list.map((o) => (
                  <OfferRow key={o.id} o={o} onToggle={() => toggle(o.id)} onClick={() => setSelected(o)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      <OfferDetail o={selected} onClose={() => setSelected(null)} />
    </div>
  );
};
